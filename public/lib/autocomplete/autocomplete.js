/*
An ES6 Class-based implementation of an autocomplete dropdown list select control.
Copyright © Michael Eberhart (suretalent.blogspot.com), 2020, All Rights Reserved

This control includes these features:
- Incrementally updates available options (shown in the dropdown) as user types
- Ability to limit user to choosing only one of the choices provided
- Callback for onSelect (essentially onChange); currently fires as soon as selection is
  changed, but code rather easily altered to only fire on focus leaving the control.
- Automatically positions cursor at end of text upon selection or tabbing into the
  control when values already exist, thus backspace-from-end is possible vs. del-from-begin.
- If limit-to-list enabled, chooses next-closest-choice-value on focus-leave if the
  entry-field is left empty, partially-filed, or with a invalid-choice typed in.
- It is fast, and relatively simple code, which makes use of some newer browser features
  like mutationObservers (for keyboard and pasted-values detection).

Just create an editable-div element in your HTML, and then instantiate this control,
passing a reference to the editable-div as the constructor argument.
Next, set any options, the onSelectCallback, assign the available values, and initialize it.

Example usage:
HTML:
    <div id="entryField" contenteditable="true" class="edit-div" tabindex="0"></div>

JS:
    //instantiate
    let myAutoComplete = new AutoCompleteDropdownControl(document.getElementById('entryField'));
    //set some properties
    myAutoComplete.limitToList = true;
    myAutoComplete.onSelectCallback = function () {console.log(myAutoComplete.value);};

    //now set the options/choices available, either something like this...
    myAutoComplete.optionValues = getUniqueKnownValuesArray();
    //... or by directly assigning an array, e.g.,...
    myAutoComplete.optionValues = {'first', 'second', 'nth item'};
    myAutocomplete.initialize();
*/

class AutoCompleteDropdownControl {

    constructor(elSelectorControl) {
        const self = this; //need reference for nested functions access to "this"
        this.elSel = elSelectorControl; //the editable DIV used as entry-box

        /*
        ═══════════════════════════════════════════════════════════════════════════════════════
        Hold the latest selected value.
        Control-consumer should retrieve this via the getter: value.
        ═══════════════════════════════════════════════════════════════════════════════════════
        */
        this.selectedValue  = '';

        /*
        ═══════════════════════════════════════════════════════════════════════════════════════
        Some defaults. Override via setters after the AutoComplete is instantiated.
        ═══════════════════════════════════════════════════════════════════════════════════════
        */
        this.choicesArray   = [];
        this.restrictEntryToOptionValues = true;
        this.minChars       = 1; //required min # chars entered before dropdown shows
        this.offsetLeft     = 0;
        this.offsetTop      = 1;
        this.onSelectCallback = function () {}; //e.g., function () {console.log(instancename.value);};

        /*
        ═══════════════════════════════════════════════════════════════════════════════════════
        Create choices-dropdown-region div container.
        The individual choice-divs will be built within this (for each item in choicesArray)
        ═══════════════════════════════════════════════════════════════════════════════════════
        */
        this.divChoices = document.createElement('div');
        this.divChoices.className = 'acd-choices';
        document.body.appendChild(this.divChoices);

        /*
        ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
        Use Mutation-Observer features to trap UI changes:
        1) typing inside answer-fields
        2) pasting

        https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
        config = Options for the observer (which mutations to observe)
                 subtree : catches keyboard events

        NOTE: Firefox bug v60-108(+?) browser does not issue any characterData
        mutation for the FIRST character entered into the editable div!
        ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
        */
        const mutation_observer_config = { childlist: false, subtree: true, characterData: true, characterDataOldValue: true };

        // Callback function to execute when mutations are observed
        let sel_mutation_callback = function(mutationsList) {
            for (let mutation of mutationsList) {
                if ( (mutation.type === 'characterData') && (mutation.target.ownerDocument.activeElement !== undefined)) {
                    let selText = mutation.target.ownerDocument.activeElement.textContent;

                    self.onSelChange(selText);
                }
            }
        };

        // Create an observer instance linked to the callback function
        let vSel_observer = new MutationObserver(sel_mutation_callback);
        // Start observing the target node for configured mutations
        vSel_observer.observe(this.elSel, mutation_observer_config);

        /*
        ═══════════════════════════════════════════════════════════════════════════════════════
        Setup event-handlers
        ═══════════════════════════════════════════════════════════════════════════════════════
        */
        //catch resize so dropdown-region can be altered if necessary
        window.addEventListener('resize', () => {this.drawOptionsContainer();});

        this.elSel.addEventListener('focus', () => {this.positionCursorAtEndOfEntryText();}, false);
        this.elSel.addEventListener('blur', () => {this.processFocusOut();}, false);
        this.elSel.addEventListener('keydown', (event) => {this.keydownHandler(event);}, false);
        this.divChoices.addEventListener('mouseup', (event) => {this.onMouseUp(event);}, false);
        this.divChoices.addEventListener('mouseover', (event) => {this.onMouseOver(event);}, false);
        this.createPasteHandler();
    } //constructor


    /*
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    Getters and Setters....
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    */

    /*
    ═══════════════════════════════════════════════════════════════════════════════════════
    The choices (i.e., dropdown value options) array value is set outside constructor
    so that it can be updated at whatever point makes sense -- whether in an XHR/Fetch
    request or synchronously at the start.

    Simple array of values: e.g., {'value1','value2','valueN'}
    Setting new array values clears edit field and all built dropdown HTML.
    ═══════════════════════════════════════════════════════════════════════════════════════
    */
    get optionValues() {
        return arrayOfOptionsValues;
    }  

    set optionValues(arrayOfOptionsValues) {
        this.divChoices.innerHTML = '';
        this.elSel.innerText = '';
        this.choicesArray = arrayOfOptionsValues;
        this.minChars = (arrayOfOptionsValues.length > 500 ? 1 : 0); //TODO: more flexible settings somehow?!
        this.onSelChange('');
    }

    /*
    ═══════════════════════════════════════════════════════════════════════════════════════
    Set this to true in order to restrict/force the user to only use value(s) available
    in the dropdown of optionValues -- this is the default behavior.
    ═══════════════════════════════════════════════════════════════════════════════════════
    */
    get limitToList() {
        return this.restrictEntryToOptionValues;
    }
    set limitToList(areChoicesLimited) {
        this.restrictEntryToOptionValues = (areChoicesLimited ? true : false);
    }

    /*
    ═══════════════════════════════════════════════════════════════════════════════════════
    The following Property-setters should be rather obvious...
    ═══════════════════════════════════════════════════════════════════════════════════════
    */
    set onSelect(onSelectCallbackFx){
        this.onSelectCallback = onSelectCallbackFx;
    }

    set dropdownOffsetTop(intOffset) {
        this.offsetTop = parseInt(intOffset) || 1;
    }

    set dropdownOffsetLeft(intOffset) {
        this.offsetLeft = parseInt(intOffset) || 0;
    }

    /*
    ═══════════════════════════════════════════════════════════════════════════════════════
    The currently-selected value.
    This must be a value chosen from drop-down if restrictEntryToOptionValues (set via
    limitToList option) is true. Otherwise it may be any value typed by user or a value
    chosen from the dropdown options.
    ═══════════════════════════════════════════════════════════════════════════════════════
    */
    get value() {
        return this.selectedValue;
    }

    //With ideal encapsulation, this would be private
    setSelectedValue(newValue) {
        if (this.selectedValue !== newValue) {
            this.selectedValue = newValue;
            this.onSelectCallback();
        }
    }

    //MUST call this before the control is usable!
    initialize() {  
        this.onSelChange(''); //force initial load (only matters when minChars=0)
        this.drawOptionsContainer();
    }


    /*
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    When the selection text changes, either by typing or pasting, regenerate the available
    matching selection choice(s) that are available.
    Only show the dropdown choices if the minimum entry-length-to-trigger-dropodown is met.
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    */
    onSelChange(newText) {
        this.divChoices.innerHTML = '';

        const entryLen = newText.length;

        if (entryLen < this.minChars) return;
        newText = newText.toUpperCase();

        let choiceText = '';
        let choiceBeginChars = '';

        for (let i = 0; i < this.choicesArray.length; i++) {
            choiceText = this.choicesArray[i].toUpperCase();
            choiceBeginChars = choiceText.substring(0, entryLen);

            //test for from-the-beginning-match; also, special case for when no min-entry required before showing dropdown
            if ((choiceBeginChars === newText) || (entryLen === 0) ) {
                const aChoiceDiv = document.createElement('div');
                //Does entirety match an option?
                if (choiceText === newText) {
                    aChoiceDiv.className = 'acd-choice selected';
                } else {
                    aChoiceDiv.className = 'acd-choice';
                }
                aChoiceDiv.setAttribute('data-val', choiceText);
                aChoiceDiv.innerHTML = `<b>${newText}</b>${choiceText.substring(entryLen)}`; //highlight the matched part
                this.divChoices.appendChild(aChoiceDiv);
            }
        }

        this.drawOptionsContainer();
    } //onSelChange



    keydownHandler(e){
        const divChoices = this.divChoices;
        const key = e.keyCode;
        let elMoveTo = undefined;
        const divSelected = divChoices.querySelector('.acd-choice.selected');

        divChoices.style.display = 'block';
        switch (key) {
            //Arrow keys: down (40), up (38)
            case 38:
            case 40:
                if (!divChoices.hasChildNodes()) return;
                e.preventDefault(); //prevent the cursor from moving inside the elSel div.

                if (!divSelected) {
                    elMoveTo = divChoices.firstChild;
                } else {
                    //move up or down, but do not allow scrolling past end or beginning of choices.
                    elMoveTo = (key === 40) ? (divChoices.lastChild === divSelected ? divSelected : divSelected.nextSibling) : (divChoices.firstChild === divSelected ? divSelected : divSelected.previousSibling);
                    divSelected.className = divSelected.className.split(' selected').join('');
                }

                elMoveTo.className += ' selected';

                divChoices.style.display = 'block';
                if (!divChoices.maxHeight) {
                    divChoices.maxHeight = parseInt((window.getComputedStyle ? getComputedStyle(divChoices, null) : divChoices.currentStyle).maxHeight);
                }
                
                if (!divChoices.choiceHeight) divChoices.choiceHeight = divChoices.querySelector('.acd-choice').offsetHeight;
                
                if (divChoices.choiceHeight)
                    if (!elMoveTo) divChoices.scrollTop = 0;
                    else {
                        const scrTop = divChoices.scrollTop;
                        const selTop = elMoveTo.getBoundingClientRect().top - divChoices.getBoundingClientRect().top;

                        if (selTop + divChoices.choiceHeight - divChoices.maxHeight > 0)
                            divChoices.scrollTop = selTop + divChoices.choiceHeight + scrTop - divChoices.maxHeight;
                        else if (selTop < 0)
                            divChoices.scrollTop = selTop + scrTop;
                    }

                    this.setSelectedValue(elMoveTo.innerText);

                break;
            //ESC-key: hide the open choices-dropdown-div, set text, move cursor
            case 27:
                divChoices.style.display = 'none';
                this.elSel.innerText = this.selectedValue;
                this.positionCursorAtEndOfEntryText();
                this.onSelectCallback();
                break;
            //Enter/Tab
            case 13:
                this.processSelectionAction(13);
                e.preventDefault();
                break;
            case 9:
                this.processSelectionAction(9);
                break;
        } //switch
        this.drawOptionsContainer();
    } //keydownHandler


    /*
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    Paste-event intercept required to trigger a DOM change that the MutationObserver will
    catch.  Otherwise, when the field was empty prior to a paste (i.e., blank), the paste
    did not fire a DOM change (seems like a browser bug!).
    Also, this makes sure all values are pasted as TEXT (i.e., stripped of HTML).
    TODO: may still need to strip additional junk like non-printing chars, etc.?
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    */
    createPasteHandler() {
        this.elSel.addEventListener('paste', (e) => {
            // Prevent the default pasting event
            e.preventDefault();
            let text = '';
            if (e.clipboardData || e.originalEvent.clipboardData) {
              text = (e.originalEvent || e).clipboardData.getData('text/plain');
            } else if (window.clipboardData) {
              text = window.clipboardData.getData('Text');
            }
            text = text.trimLeft();
            text = text.split('\n').join(''); //remove line breaks
            text = text.replace(/[^\x20-\xFF]/gi, ''); //remove non-UTF-8 chars

            if (document.queryCommandSupported('insertText')) {
              document.execCommand('insertText', false, text);
            } else {
              document.execCommand('paste', false, text);
            }
        });
    }


    /*
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    This is called when the selection text changes or a resize-event occurs.
    Update choices-div-container -- width/height to show only the number of rows (divs)
    that fit within the specified max-height.
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    */
    drawOptionsContainer() {
        const divChoices = this.divChoices;
        const rect = this.elSel.getBoundingClientRect();

        divChoices.style.left  = Math.round(rect.left   + (window.pageXOffset || document.documentElement.scrollLeft)   + this.offsetLeft) + 'px';
        divChoices.style.top   = Math.round(rect.bottom + (window.pageYOffset || document.documentElement.scrollTop)    + this.offsetTop)  + 'px';
        divChoices.style.width = Math.round(rect.right  - rect.left) + 'px'; // outerWidth
    }

    onMouseOver(e) {
        const divChoices = this.divChoices;
        if (!divChoices.hasChildNodes()) return;

        const divSelected = divChoices.querySelector('.acd-choice.selected');
        if (divSelected) divSelected.className = divSelected.className.split(' selected').join('');

        let elMoveTo = e.target;
        elMoveTo.className += ' selected';
    }


    //Don't trigger selection if the event is the choices-container
    // (this happens if mouse is over choices-scrollbar during mouseup)
    onMouseUp(e) {
        if (e.target !== this.divChoices) {
            this.processSelectionAction(13);
        }
    }

    //When focus lost, if the choices-dropdown-div was open, handle like tabbing out of the control
    processFocusOut() {
        if (this.divChoices.style.display  !== 'none') {
            this.processSelectionAction(9);
        }
    }

    reset() {
        const divChoices = this.divChoices;
        const divSelected = divChoices.querySelector('.acd-choice.selected');
        if (divSelected) {
            divSelected.setAttribute('data-val', '');
        }
        if (divChoices.firstChild) {
            divChoices.firstChild.setAttribute('data-val', '');
        }
    }

    /*
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    The behavior of enter-key (selecting a choice) and a mouseclick doing the same is
    essentially identical, with the exception of the latter not requiring preventdefault.

    The tab-key is similar also, but does not require setting the cursor-position after
    any selection (since user is exiting the field completely).

    Parameter: key = numeric keycode (9=tab action, 13 = enter/CR)
      For mouseclick, send a 13 since it is handled just like enter.
    ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    */
    processSelectionAction(key) {
        const divChoices = this.divChoices;
        this.divChoices.style.display = 'none';

        const divSelected = divChoices.querySelector('.acd-choice.selected');
        let currentSelValue = '';

        if (divSelected) {
            currentSelValue = divSelected.getAttribute('data-val');
        } else {
            if (this.restrictEntryToOptionValues) {
                if (divChoices.firstChild) {
                    currentSelValue = divChoices.firstChild.getAttribute('data-val');
                } else {
                    //Choose closest alphabetically in list of choices when possible
                    if (key != 9) {
                        currentSelValue = (this.choicesArray.length !== 0 ? this.choicesArray.reduce((prev, curr) => prev < this.elSel.innerText ? curr : prev) : '');
                    }
                }
            } else {
                currentSelValue = this.elSel.innerText;
            }
        }

        this.elSel.innerText = currentSelValue;
        this.setSelectedValue(currentSelValue);

        //If Enter-key, remain in div and set the cursor-position immediately after chosen value in the editable-Div
        if (key === 13) {
            this.positionCursorAtEndOfEntryText();
        }
    } //processSelectionAction


    positionCursorAtEndOfEntryText() {
        if (this.elSel.firstChild) {
            const range = document.createRange();
            range.setStart(this.elSel.firstChild, this.selectedValue.length);
            range.collapse(true);

            const winSel = window.getSelection();
            winSel.removeAllRanges();
            winSel.addRange(range);
        }
    }

} //class
