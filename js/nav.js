var isNavOpen = false;

function openNav(){
        document.getElementById("sideNavigation").style.width = "250px";
        document.getElementById("mainhub").style.marginLeft = "250px";
        isNavOpen=true;
}

function closeNav() {
        document.getElementById("sideNavigation").style.width = "0";
        document.getElementById("mainhub").style.marginLeft = "0";
        isNavOpen=false;

}

function toggleNav() {
    if (!isNavOpen) {
        openNav();
    } else {
        closeNav();
    }
}
